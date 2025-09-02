import { IsNumber, IsPositive, IsString, Min, MinLength } from 'class-validator';

export class ReduceStockDto {
  @IsNumber()
  @IsPositive()
  productId: number;

  @IsNumber()
  @Min(1)
  quantity: number;
}