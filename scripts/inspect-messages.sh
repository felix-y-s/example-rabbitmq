#!/bin/bash

# RabbitMQ 메시지 내용 확인 스크립트

QUEUE_NAME=${1:-"payment-failed-queue"}
MESSAGE_COUNT=${2:-5}

echo "=== RabbitMQ 메시지 내용 확인 ==="
echo "큐: $QUEUE_NAME"
echo "메시지 수: $MESSAGE_COUNT"
echo

# Management API를 통해 메시지 내용 확인
echo "🔍 메시지 내용 조회 중..."

curl -s -u admin:admin123 \
  -H "Content-Type: application/json" \
  -X POST \
  -d "{\"count\":$MESSAGE_COUNT,\"ackmode\":\"ack_requeue_true\",\"encoding\":\"auto\"}" \
  "http://localhost:15672/api/queues/%2F/$QUEUE_NAME/get" | \
  jq -r '
    if length == 0 then
      "❌ 큐에 메시지가 없습니다."
    else
      "📨 발견된 메시지 (" + (length | tostring) + "개):\n" +
      "════════════════════════════════════════\n" +
      (to_entries[] |
        "🆔 메시지 #" + (.key + 1 | tostring) + "\n" +
        "📄 페이로드: " + (.value.payload // "없음") + "\n" +
        "🏷️  Exchange: " + (.value.exchange // "없음") + "\n" +
        "🔑 Routing Key: " + (.value.routing_key // "없음") + "\n" +
        "🔄 재전송 여부: " + (.value.redelivered | tostring) + "\n" +
        "📊 속성: " + (.value.properties | tostring) + "\n" +
        "────────────────────────────────────────\n"
      )
    end
  '

echo
echo "💡 사용법:"
echo "$0 [큐이름] [메시지수]"
echo "예시: $0 payment-failed-queue 3"