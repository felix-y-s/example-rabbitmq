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

  async healthCheck(): Promise<{ database: string, timestamp: string }> {
    try {
      await this.prismaService.$queryRaw`SELECT 1`;

      return {
        database: 'connected',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('데이터베이스 연결 실패', error);
      return {
        database: 'disconnected',
        timestamp: new Date().toISOString(),
      };
    }
  }
}
