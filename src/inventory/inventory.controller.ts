import { includes } from './../../node_modules/effect/src/RuntimeFlagsPatch';
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
import { CreateProductDto } from './dto/create-product.dto';
import { ReduceStockDto } from './dto/reduce-stock.dto';
import { timestamp } from 'rxjs';

@Controller('inventory')
export class InventoryController {
  // private readonly logger = new Logger(InventoryController.name);

  // constructor(private readonly inventoryService: InventoryService) {}

  // @Post('reduce-stock')
  // async reduceStock(@Body() reduceStockDto: ReduceStockDto) {
  //   this.logger.debug(`재고 감소 요청: ${JSON.stringify(reduceStockDto)}`);
  // }

  // @Get('stock/:productId')
  // async getStock(@Param('productId') productId: number) {
  //   this.logger.debug(`재고 조사: ${productId}`);
  //   try {
  //     const stock = await this.inventoryService.getStock(productId);

  //     if (stock === null) {
  //       throw new HttpException(
  //         {
  //           statusCode: HttpStatus.NOT_FOUND,
  //           message: `요청한 물품을 찾을 수 없습니다. (${productId})`,
  //         },
  //         HttpStatus.NOT_FOUND,
  //       );
  //     }

  //     return {
  //       statusCode: HttpStatus.OK,
  //       data: {
  //         stock,
  //       },
  //       timestamp: new Date().toISOString(),
  //     };
  //   } catch (error) {
      
  //     // if (
  //     //   error instanceof HttpException 
  //     //   // && error.message.includes('요청한 물품을 찾을 수 없습니다.')
  //     // ) {
  //     //   throw error;
  //     // }
      
  //     this.logger.error('물품 수량을 확인 중 오류:', error);
  //     throw new HttpException(
  //       {
  //         statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
  //         message: '물품 수량을 확인 중 오류가 발생했습니다.'
  //       },
  //       HttpStatus.INTERNAL_SERVER_ERROR,
  //     )
  //   }
  // }

  // @Post('products')
  // async createProducts(@Body() dto: CreateProductDto) {
  //   this.logger.debug(`상품 생성: ${JSON.stringify(dto)}`);

  //   try {
  //     const result = await this.inventoryService.createProduct(
  //       dto.name,
  //       dto.description,
  //       dto.price,
  //       dto.initialStock,
  //     );

  //     return {
  //       statusCode: HttpStatus.OK,
  //       data: {
  //         id: result.id,
  //         stock: result.stock,
  //       },
  //       timestamp: new Date().toISOString(),
  //     };
  //   } catch (error) {
  //     this.logger.error('상품 생성 중 오류', error);
  //     throw new HttpException(
  //       {
  //         statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
  //         message: '상품 생성 중 서버 오류가 발생했습니다.',
  //         timestamp: new Date().toISOString(),
  //       },
  //       HttpStatus.INTERNAL_SERVER_ERROR,
  //     );
  //   }
  // }

  // @Post('test/concurrent-reduce')
  // async concurrentReduce(
  //   @Body()
  //   params: {
  //     productId: string;
  //     quantity: number;
  //     requestCount: number;
  //   },
  // ) {
  //   this.logger.debug(`동시성 테스트 진행: ${JSON.stringify(params)}`);
  // }

  // @Get('health')
  // async health() {
  //   this.logger.debug(`헬스 체크`);
  // }
}
