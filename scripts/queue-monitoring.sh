#!/bin/bash

# RabbitMQ 큐 모니터링 스크립트

echo "=== RabbitMQ 큐 모니터링 ==="
echo

# 1. 전체 큐 목록 및 메시지 수
echo "📋 큐 목록 및 메시지 수:"
docker exec rabbitmq rabbitmqctl list_queues name messages consumers durable
echo

# 2. 특정 큐 상세 정보
echo "🔍 큐 상세 정보 (arguments 포함):"
docker exec rabbitmq rabbitmqctl list_queues name messages consumers arguments --formatter=pretty_table
echo

# 3. Exchange 정보
echo "🔄 Exchange 목록:"
docker exec rabbitmq rabbitmqctl list_exchanges name type durable --formatter=pretty_table
echo

# 4. 바인딩 정보
echo "🔗 바인딩 정보:"
docker exec rabbitmq rabbitmqctl list_bindings source_name destination_name routing_key --formatter=pretty_table
echo

# 5. 연결 상태
echo "🌐 연결 상태:"
docker exec rabbitmq rabbitmqctl list_connections name state --formatter=pretty_table
echo

# 6. 시스템 상태 요약
echo "📊 시스템 상태:"
docker exec rabbitmq rabbitmqctl cluster_status
echo

echo "✅ 모니터링 완료"
echo "💡 Management UI: http://localhost:15672 (admin/admin123)"