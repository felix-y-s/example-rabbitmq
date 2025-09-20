import { Body, Controller, Post, Get, Param } from '@nestjs/common';
import { OrderService } from './order.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { v4 as uuidv4 } from 'uuid';

@Controller('order')
export class OrderController {
  constructor(
    private readonly orderService: OrderService,
    private readonly amqpConnection: AmqpConnection
  ) {}

  @Post()
  async createOrder(@Body() orderDto: CreateOrderDto) {
    this.orderService.createOrder({
      orderId: uuidv4(),
      customerId: orderDto.customerId,
      items: orderDto.items,
    });
  }

  @Post('payment')
  async payment() {
    this.orderService.payment(
      uuidv4(), 100, 'card', uuidv4()
    )
  }

  @Get('queue-status')
  async getQueueStatus() {
    try {
      // RabbitMQ Management API 호출
      const response = await fetch('http://localhost:15672/api/queues', {
        headers: {
          'Authorization': 'Basic ' + Buffer.from('admin:admin123').toString('base64')
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const queues = await response.json();

      return {
        status: 'success',
        queues: queues.map((queue: any) => ({
          name: queue.name,
          messages: queue.messages,
          consumers: queue.consumers,
          state: queue.state,
          arguments: queue.arguments
        }))
      };
    } catch (error) {
      return {
        status: 'error',
        message: 'Queue status check failed',
        error: error.message
      };
    }
  }

  @Get('connection-status')
  async getConnectionStatus() {
    try {
      const isConnected = this.amqpConnection.managedConnection.isConnected();

      return {
        status: 'success',
        connected: isConnected,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'error',
        connected: false,
        error: error.message
      };
    }
  }

  @Get('queue/:queueName/messages')
  async getQueueMessages(@Param('queueName') queueName: string) {
    try {
      // RabbitMQ Management API로 메시지 내용 확인
      const response = await fetch(`http://localhost:15672/api/queues/%2F/${queueName}/get`, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from('admin:admin123').toString('base64'),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          count: 5,
          ackmode: 'ack_requeue_true', // 메시지를 큐에 다시 넣음
          encoding: 'auto'
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const messages = await response.json();

      return {
        status: 'success',
        queue: queueName,
        messageCount: messages.length,
        messages: messages.map((msg: any, index: number) => ({
          id: index + 1,
          payload: msg.payload, // 실제 메시지 내용
          properties: msg.properties,
          routing_key: msg.routing_key,
          exchange: msg.exchange,
          redelivered: msg.redelivered,
          message_count: msg.message_count
        }))
      };
    } catch (error) {
      return {
        status: 'error',
        message: 'Failed to get queue messages',
        error: error.message
      };
    }
  }
}
