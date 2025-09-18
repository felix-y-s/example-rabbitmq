import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { ReduceStockDto } from './dto/reduce-stock.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { RedisService } from '@liaoliaots/nestjs-redis';

@Controller('inventory')
export class InventoryController {
  private readonly logger = new Logger(InventoryController.name);
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly redisService: RedisService,
  ) {}

  @Post('reduce-stock-redis-lock')
  async reduceStockRedisLock(@Body() reduceStockDto: ReduceStockDto) {
    return this.inventoryService.reduceStockRedisLock(
      reduceStockDto.productId,
      reduceStockDto.quantity,
    );
  }

  // 동시 테스트 - redis lock
  @Post('test/reduce-stock-redis-lock')
  async testReduceStockRedisLock(
    @Body() dto: { productId: number; quantity: number; requestCount: number },
  ) {
    this.logger.debug(`동시성 테스트 시작: ${JSON.stringify(dto, null, 2)}`);
    const promiseAll = await Promise.all(
      Array.from({ length: dto.requestCount }).map(async (_, index) => {
        try {
          return await this.reduceStockRedisLock(dto);
        } catch (error) {
          return {
            success: false,
            message: error?.message || 'Unknown Error',
          };
        }
      }),
    );

    const failedJob = promiseAll.filter((pred) => !pred.success);
    const failedCount = failedJob.length;
    const successCount = promiseAll.length - failedCount;
    const failedMessages = failedJob.map((val) => val.message);

    return {
      successCount,
      failedCount,
      failedMessages,
      jobs: promiseAll,
    };
  }

  @Post('reduce-stock')
  async reduceStock(@Body() reduceStockDto: ReduceStockDto) {
    this.logger.log(`재고 감소 요청: ${JSON.stringify(reduceStockDto)}`);

    try {
      const result = await this.inventoryService.reduceStockOptimistic(
        reduceStockDto.productId,
        reduceStockDto.quantity,
      );

      if (!result.success) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: result.message,
            timestamp: new Date().toISOString(),
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // 재고 감소 성공 시 캐시 무효화
      const redis = this.redisService.getOrThrow('cache');
      const cacheKey = `stock:${reduceStockDto.productId}`;
      await redis.del(cacheKey);
      this.logger.log(`재고 캐시 무효화: ${reduceStockDto.productId}`);

      return {
        statusCode: HttpStatus.OK,
        message: result.message,
        data: {
          productId: reduceStockDto.productId,
          reduceQuantity: reduceStockDto.quantity,
          remainingStock: result.finalStock,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('재고 감소 처리 중 오류:', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: '재고 처리 중 서버 오류가 발생했습니다.',
          timestamp: new Date().toISOString(),
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('reduce-stock-pessimistic')
  async reduceStockPessimistic(@Body() reduceStockDto: ReduceStockDto) {
    this.logger.log(
      `재고 감소 요청(비관적 락): ${JSON.stringify(reduceStockDto)}`,
    );

    const result = await this.inventoryService.reduceStockPessimistic(
      reduceStockDto.productId,
      reduceStockDto.quantity,
    );

    // 재고 감소 성공 시 캐시 무효화
    if (result && result.success) {
      const redis = this.redisService.getOrThrow('cache');
      const cacheKey = `stock:${reduceStockDto.productId}`;
      await redis.del(cacheKey);
      this.logger.log(
        `재고 캐시 무효화(비관적 락): ${reduceStockDto.productId}`,
      );
    }

    return result;
  }

  @Get('stock/:productId')
  async getStock(@Param('productId') productId: number) {
    try {
      const redis = this.redisService.getOrThrow('cache');
      const cacheKey = `stock:${productId}`;

      // 캐시에서 먼저 조회
      const cachedStock = await redis.get(cacheKey);
      if (cachedStock !== null) {
        this.logger.log(`캐시에서 재고 조회: ${productId}`);
        return {
          statusCode: HttpStatus.OK,
          data: {
            productId,
            stock: parseInt(cachedStock),
          },
          timestamp: new Date().toISOString(),
        };
      }

      // 캐시에 없으면 DB에서 조회
      const stock = await this.inventoryService.getStock(productId);

      if (stock === null) {
        throw new HttpException(
          {
            statusCode: HttpStatus.NOT_FOUND,
            message: '상품을 찾을 수 없습니다.',
            timestamp: new Date().toISOString(),
          },
          HttpStatus.NOT_FOUND,
        );
      }

      // 조회 결과를 캐시에 저장 (5분 TTL)
      await redis.setex(cacheKey, 300, stock.toString());
      this.logger.log(`재고 정보 캐시 저장: ${productId} = ${stock}`);

      return {
        statusCode: HttpStatus.OK,
        data: {
          productId,
          stock,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('남은 수량 조회 중 에러 발생:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '알수없는 오류 발생',
      };
    }
  }

  // 🛍️ 상품 생성 API (테스트용)
  @Post('products')
  async createProducts(@Body() createProductsDto: CreateProductDto) {
    this.logger.log(
      `🚀 | InventoryController | createProducts | createProductsDto:`,
      createProductsDto,
    );
    try {
      const product = await this.inventoryService.createProduct(
        createProductsDto.name,
        createProductsDto.price,
        createProductsDto.initialStock,
      );
      return {
        statusCode: HttpStatus.OK,
        message: '상품이 생성되었습니다.',
        data: {
          id: product.id,
          name: product.name,
          price: product.price,
          stock: product.stock,
          version: product.version,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('상품 생성 중 오류:', error);
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: '상품 생성 중 서버 오류가 발생했습니다.',
          timestamp: new Date().toISOString(),
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // 동시성 테스트용 엔트포인트
  @Post('test/concurrent-reduce')
  async testConcurrentReduction(
    @Body() body: { productId: number; quantity: number; requestCount: number },
  ) {
    this.logger.log(`동시성 테스트 시작 - ${body.requestCount}개 요청`);

    const { productId, quantity, requestCount } = body;
    const startTime = Date.now();

    // 동시에 여러 요청 실행
    const promises = Array.from({ length: requestCount }, (_, index) => {
      this.logger.log(`요청 ${index} 시작 - ${new Date().toISOString()}`);
      return this.inventoryService
        .reduceStockOptimistic(productId, quantity)
        .then((result) => {
          this.logger.log(`요청 ${index} 완료 - ${new Date().toISOString()}`);
          return { index, result };
        })
        .catch((error: Error) => {
          this.logger.error(`요청 ${index} 에러 - ${new Date().toISOString()}`);
          return { index, error: error.message };
        });
    });

    const results = await Promise.all(promises);
    const endTime = Date.now();

    const successCount = results.filter((r) => {
      if ('result' in r && r.result.success) return true;
      else return false;
    }).length;

    return {
      statusCode: HttpStatus.OK,
      message: '동시성 테스트 완료',
      data: {
        successfulReductions: successCount,
        executionTimeMs: endTime - startTime,
        results: results.slice(0, 15),
      },
      timestamp: new Date().toISOString(),
    };
  }

  // 동시성 테스트용 엔트포인트
  @Post('test/concurrent-reduce-pessimistic')
  async testConcurrentReductionPessimistic(
    @Body() body: { productId: number; quantity: number; requestCount: number },
  ) {
    this.logger.log(
      `동시성 테스트 시작(비관적 락) - ${body.requestCount}개 요청`,
    );

    const { productId, quantity, requestCount } = body;
    const startTime = Date.now();

    // 동시에 여러 요청 실행
    const promises = Array.from({ length: requestCount }, (_, index) => {
      this.logger.log(`요청 ${index} 시작 - ${new Date().toISOString()}`);
      return this.inventoryService
        .reduceStockPessimistic(productId, quantity)
        .then((result) => {
          this.logger.log(`요청 ${index} 완료 - ${new Date().toISOString()}`);
          return { index, result };
        })
        .catch((error: Error) => {
          this.logger.error(`요청 ${index} 에러 - ${new Date().toISOString()}`);
          return { index, error: error.message };
        });
    });

    const results = await Promise.all(promises);
    const endTime = Date.now();

    const successCount = results.filter((r) => {
      if ('result' in r && r.result?.success) return true;
      else return false;
    }).length;

    return {
      statusCode: HttpStatus.OK,
      message: '동시성 테스트 완료',
      data: {
        successfulReductions: successCount,
        executionTimeMs: endTime - startTime,
        results: results.slice(0, 15),
      },
      timestamp: new Date().toISOString(),
    };
  }

  @Get('health')
  async healthCheck() {
    const health = await this.inventoryService.healthCheck();

    return {
      statusCode: HttpStatus.OK,
      message: '헬스체크 완료',
      data: health,
      timestamp: new Date().toISOString(),
    };
  }
}
