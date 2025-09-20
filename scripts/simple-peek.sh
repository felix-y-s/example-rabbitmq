#!/bin/bash

# 간단한 메시지 엿보기 도구
QUEUE_NAME=${1:-"payment-queue"}

echo "👀 $QUEUE_NAME 큐 메시지 엿보기"
echo

# 큐 상태 먼저 확인
echo "📊 큐 상태:"
docker exec rabbitmq rabbitmqctl list_queues name messages consumers | grep $QUEUE_NAME

echo
echo "💡 메시지 내용을 보려면 Management UI를 사용하세요:"
echo "   http://localhost:15672 → Queues → $QUEUE_NAME → Get Messages"
echo
echo "🔧 또는 애플리케이션 로그에서 확인:"
echo "   컨슈머가 메시지를 처리할 때 로그에 내용이 출력됩니다"