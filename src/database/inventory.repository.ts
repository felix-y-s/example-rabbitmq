import { Injectable, Logger } from '@nestjs/common';
import { Product } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';
import { Prisma } from '@prisma/client';
import { BaseRepository } from './base.repository';

@Injectable()
export class InventoryRepository extends BaseRepository {
  private readonly modelName = 'inventory';
  protected readonly logger = new Logger(InventoryRepository.name);
  constructor(protected readonly prismaService: PrismaService) {
    super(prismaService);
  }

  async findInventoryById(productId: number): Promise<Product | null> {
    return await this.prismaService.product.findUnique({
      where: { id: productId },
    });
  }

  async updateProduct(
    productId: number,
    data: Prisma.ProductUpdateInput,
  ): Promise<Product> {
    return await this.prismaService.product.update({
      where: { id: productId },
      data,
    });
  }

  async create(data: Prisma.ProductCreateInput): Promise<Product> {
    return await this.prismaService.product.create({ data });
  }

  async reduceStockWithLock(productId: number, quantity: number) {
    return await this.prismaService.$transaction(async (prisma) => {
      const products = await prisma.$queryRaw<
        Array<{
          id: number;
          stock: number;
          version: number;
        }>
      >(
        Prisma.sql`
          SELECT id, stock, version
          FROM products
          WHERE id = ${productId}
          FOR UPDATE`,
      );

      if (products.length === 0) {
        return { success: false, message: '상품을 찾을 수 없습니다.' };
      }

      const product = products[0];

      if (product.stock < quantity) {
        return {
          success: false,
          message: `재고 부족 (현재: ${product.stock}, 요청: ${quantity})`,
        };
      }

      // 재고 업데이트
      const updateProduct = await prisma.product.update({
        where: { id: productId },
        data: {
          stock: product.stock - quantity,
          version: { increment: 1 },
        },
      });

      return {
        success: true,
        message: '재고 감소 완료 (비관적 락)',
        finalStock: updateProduct.stock,
      };
    });
  }
}
