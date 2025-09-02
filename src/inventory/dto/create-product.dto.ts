import { IsNumber, IsOptional, IsPositive, IsString, MaxLength, Min } from 'class-validator';

export class CreateProductDto {
  @IsString()
  @MaxLength(100)
  name: string; // 이름

  @IsString()
  @MaxLength(500)
  @IsOptional()
  description: string;

  @IsNumber()
  @IsPositive()
  price: number;

  @IsNumber()
  @Min(0)
  initialStock: number;
}