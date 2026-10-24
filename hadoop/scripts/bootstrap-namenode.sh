#!/usr/bin/env bash
#
# NameNode bootstrap.
#
# Formats the filesystem on first start (idempotent: it checks for VERSION),
# then runs the daemon in the foreground so Docker can supervise and
# health-check it.
#
# The RPC host/port and the name directory are read from core-site.xml and
# hdfs-site.xml instead of being hard-coded, so renaming the Compose service
# or moving the storage does not require touching this script.
set -euo pipefail

HADOOP_CONF_DIR="${HADOOP_CONF_DIR:-/opt/hadoop/conf}"
export HADOOP_CONF_DIR
export HADOOP_HEAPSIZE_MAX="${HADOOP_NAMENODE_HEAP_MB:-1024}"
export HADOOP_LOG_DIR="${HADOOP_LOG_DIR:-/var/log/hadoop}"

WAREHOUSE_PATH="${HDFS_WAREHOUSE_PATH:-/warehouse}"
CHECKPOINTS_PATH="${HDFS_CHECKPOINTS_PATH:-/checkpoints}"
DBT_PATH="${HDFS_DBT_PATH:-/dbt}"

log() { echo "[namenode] $*"; }

# Print the <value> of a <property><name>KEY</name><value>VAL</value></property>
# entry of a Hadoop XML file.
xml_value() {
  tr '\n' ' ' <"$1" \
    | sed -n "s|.*<name>[[:space:]]*$2[[:space:]]*</name>[[:space:]]*<value>[[:space:]]*\([^<]*\)</value>.*|\1|p" \
    | head -1
}

name_dir_raw="$(xml_value "${HADOOP_CONF_DIR}/hdfs-site.xml" dfs.namenode.name.dir)"
name_dir="${name_dir_raw#file://}"
rpc_address="$(xml_value "${HADOOP_CONF_DIR}/core-site.xml" dfs.namenode.rpc-address)"
rpc_host="${rpc_address%:*}"
rpc_port="${rpc_address##*:}"

if [[ -z "${name_dir}" || -z "${rpc_host}" || -z "${rpc_port}" ]]; then
  log "ERROR: could not read Hadoop config from ${HADOOP_CONF_DIR}"
  log "  dfs.namenode.name.dir=[${name_dir_raw}] dfs.namenode.rpc-address=[${rpc_address}]"
  exit 1
fi

log "conf dir=${HADOOP_CONF_DIR}"
log "name dir=${name_dir}"
log "advertising rpc as ${rpc_host}:${rpc_port}"

# Bind the daemon to every interface; the advertised address (rpc-address above)
# is what clients discover, while 0.0.0.0 keeps the published port reachable.
export HDFS_NAMENODE_OPTS="-Ddfs.namenode.rpc-address=${rpc_host}:${rpc_port} \
-Ddfs.namenode.http-address=${rpc_host}:${HDFS_NAMENODE_HTTP_PORT:-9870} \
-Ddfs.namenode.datanode.registration.ip-hostname-check=false \
-Ddfs.permissions.enabled=false"

if [[ -f "${name_dir}/current/VERSION" ]]; then
  log "already formatted, skipping format"
else
  log "formatting filesystem (first start)"
  hdfs namenode -format -force -nonInteractive
fi

# Create the lakehouse directories once the daemon accepts RPC. This runs in the
# background because the daemon is exec'd below; it is best-effort, since Iceberg
# and Spark create their own table/checkpoint directories on demand anyway.
(
  for _ in $(seq 1 120); do
    if timeout 3 bash -c "exec 3<>/dev/tcp/${rpc_host}/${rpc_port}" 2>/dev/null; then
      break
    fi
    sleep 1
  done
  if hdfs dfs -mkdir -p "${WAREHOUSE_PATH}" "${CHECKPOINTS_PATH}" "${DBT_PATH}"; then
    hdfs dfs -chmod -R 777 / || true
    log "created lakehouse directories under /"
  else
    log "WARNING: could not pre-create lakehouse directories (will be created on demand)"
  fi
) &

log "ready, starting daemon"
exec hdfs namenode
