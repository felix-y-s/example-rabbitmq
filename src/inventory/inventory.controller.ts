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
import { InventoryService } from './ inventory.service';
import { ReduceStockDto } from './dto/reduce-stock.dto';
import { CreateProductDto } from './dto/create-product.dto';

@Controller('inventory')
export class InventoryController {
  private readonly logger = new Logger(InventoryController.name);
  constructor(private readonly inventoryService: InventoryService) {}

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

    return result;
  }

  @Get('stock/:productId')
  async getStock(@Param('productId') productId: number) {
    try {
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
    this.logger.log(`동시성 테스트 시작(비관적 락) - ${body.requestCount}개 요청`);

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
