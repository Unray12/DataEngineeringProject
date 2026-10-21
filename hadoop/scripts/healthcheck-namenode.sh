#!/usr/bin/env bash
#
# Container health-check for the NameNode: probes the RPC port that the
# daemon actually advertises (read from core-site.xml), so the check stays
# correct if the Compose service or ports are renamed.
set -euo pipefail

HADOOP_CONF_DIR="${HADOOP_CONF_DIR:-/opt/hadoop/conf}"
export HADOOP_CONF_DIR

rpc_address="$(tr '\n' ' ' <"${HADOOP_CONF_DIR}/core-site.xml" \
  | sed -n "s|.*<name>[[:space:]]*dfs.namenode.rpc-address[[:space:]]*</name>[[:space:]]*<value>[[:space:]]*\([^<]*\)</value>.*|\1|p" \
  | head -1)"

if [[ -z "${rpc_address}" ]]; then
  echo "cannot read dfs.namenode.rpc-address from ${HADOOP_CONF_DIR}/core-site.xml" >&2
  exit 1
fi

rpc_host="${rpc_address%:*}"
rpc_port="${rpc_address##*:}"

# The daemon binds to the address it advertises, so probe that name, not
# 127.0.0.1.
if timeout 5 bash -c "exec 3<>/dev/tcp/${rpc_host}/${rpc_port}" 2>/dev/null; then
  echo "namenode RPC reachable at ${rpc_host}:${rpc_port}"
  exit 0
fi

echo "namenode RPC not reachable at ${rpc_host}:${rpc_port}" >&2
exit 1