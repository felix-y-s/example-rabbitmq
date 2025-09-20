#!/bin/bash

echo "🧪 테스트 메시지 생성 중..."

# 결제 메시지 생성 (30초 후 실패해서 DLQ로 이동됨)
curl -s -X POST http://localhost:3000/order/payment \
  -H "Content-Type: application/json"

echo "✅ 결제 메시지 생성 완료"
echo "⏱️ 30초 후 메시지가 실패하여 DLQ로 이동됩니다"
echo

echo "📊 현재 큐 상태:"
docker exec rabbitmq rabbitmqctl list_queues name messages

echo
echo "💡 30초 후 payment-failed-queue에서 메시지 내용을 확인하세요:"
echo "   http://localhost:15672 → Queues → payment-failed-queue → Get Messages"