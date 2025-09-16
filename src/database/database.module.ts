import { Global, Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { InventoryRepository } from './inventory.repository';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [InventoryRepository],
  exports: [InventoryRepository],
})
export class DatabaseModule {}
