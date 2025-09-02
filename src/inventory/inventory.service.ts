import { Injectable } from '@nestjs/common';
import { Product } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';

@Injectable()
export class InventoryService {
  constructor(
    private readonly prismaService: PrismaService,
  ) {}

  // 🍏 상품 생성
  async createProduct(name: string, description: string, price: number, initialStock: number): Promise<Product> {
    const product = await this.prismaService.product.create({
      data: {
        name,
        description,
        price,
        stock: initialStock
      }
    })
    console.log(`🚀 | InventoryService | createProduct | product:`, product);

    return product;
  }

  // 🍎 수량 확인
  async getStock(productId: number): Promise<number | null> {
    const product = await this.prismaService.product.findUnique({
      where: { id: productId }
    })

    return product?.stock ?? null;
  }
}
