import { IsArray, IsDate, IsString } from 'class-validator';
import { OrderItem } from '../types/message.types';

export class CreateOrderDto {  
  @IsString()
  customerId: string;
  
  @IsArray()
  items: OrderItem[];
  
}