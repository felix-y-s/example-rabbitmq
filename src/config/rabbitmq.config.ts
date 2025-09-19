export default () => ({
  rabbitmq: {
    url: process.env.RABBITMQ_URL || 'amqp://localhost:5672',
    exchange: process.env.RABBITMQ_EXCHANGE || 'inventory-exchange',
    prefetchCount: parseInt(process.env.RABBITMQ_PREFETCH_COUNT || '') || 1,
    messageTTL: parseInt(process.env.RABBITMQ_MESSAGE_TTL || '') || 300000,
    maxRetries: parseInt(process.env.RABBITMQ_MAX_RETRIES || '') || 3,
  },
});