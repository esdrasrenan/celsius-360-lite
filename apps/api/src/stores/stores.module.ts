import { Module } from '@nestjs/common'
import { NowService } from '../common/time'
import { StoresController } from './stores.controller'
import { StoresService } from './stores.service'

@Module({
  controllers: [StoresController],
  providers: [StoresService, NowService],
})
export class StoresModule {}
