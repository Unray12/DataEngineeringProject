#!/usr/bin/env bash
#
# DataNode bootstrap.
#
# Waits until the NameNode answers on its RPC port, then runs the daemon in the
# foreground. Registration is by container IP (dfs.client.use.datanode.hostname
# is false in core-site.xml), so no extra hostname plumbing is needed.
set -euo pipefail

HADOOP_CONF_DIR="${HADOOP_CONF_DIR:-/opt/hadoop/conf}"
export HADOOP_CONF_DIR
export HADOOP_HEAPSIZE_MAX="${HADOOP_DATANODE_HEAP_MB:-512}"
export HADOOP_LOG_DIR="${HADOOP_LOG_DIR:-/var/log/hadoop}"

log() { echo "[datanode] $*"; }

xml_value() {
  tr '\n' ' ' <"$1" \
    | sed -n "s|.*<name>[[:space:]]*$2[[:space:]]*</name>[[:space:]]*<value>[[:space:]]*\([^<]*\)</value>.*|\1|p" \
    | head -1
}

rpc_address="$(xml_value "${HADOOP_CONF_DIR}/core-site.xml" dfs.namenode.rpc-address)"
rpc_host="${rpc_address%:*}"
rpc_port="${rpc_address##*:}"

if [[ -z "${rpc_host}" || -z "${rpc_port}" ]]; then
  log "ERROR: could not read dfs.namenode.rpc-address from ${HADOOP_CONF_DIR}/core-site.xml"
  exit 1
fi

log "waiting for namenode at ${rpc_host}:${rpc_port}"
for attempt in $(seq 1 60); do
  if timeout 3 bash -c "exec 3<>/dev/tcp/${rpc_host}/${rpc_port}" 2>/dev/null; then
    log "namenode reachable after ${attempt} attempt(s)"
    break
  fi
  if [[ "${attempt}" -eq 60 ]]; then
    log "ERROR: namenode did not become reachable"
    exit 1
  fi
  sleep 2
done

export HDFS_DATANODE_OPTS="-Ddfs.client.use.datanode.hostname=false \
-Ddfs.permissions.enabled=false"

log "ready, starting daemon"
exec hdfs datanode