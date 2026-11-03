import { Module } from '@nestjs/common'
import { NowService } from '../common/time'
import { EnvironmentsController } from './environments.controller'
import { EnvironmentsService } from './environments.service'

@Module({
  controllers: [EnvironmentsController],
  providers: [EnvironmentsService, NowService],
})
export class EnvironmentsModule {}
