import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';

export abstract class BaseRepository {
  // abstract readonly model;
  protected abstract readonly logger: Logger;
  constructor(protected readonly prismaService: PrismaService) {}

  async healthCheck(): Promise<{ database: string; timestamp: string }> {
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

  /**
   * 추가 공통 함수들 추가
   */
}
