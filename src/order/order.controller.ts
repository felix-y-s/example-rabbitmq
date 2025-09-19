import { Controller, Get } from '@nestjs/common';
import { OrderService } from './order.service';

@Controller('order')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}
  
  @Get('test/rabbitmq')
  async testRabbitmq() {
    return this.orderService.createOrder({ customerId: 'test', orderId: '10' });
  }

}