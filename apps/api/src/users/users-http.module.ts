import { Module } from '@nestjs/common';
import { MeController } from './me.controller.js';

/** HTTP endpoints for the current user; imported by the API process only. */
@Module({
  controllers: [MeController],
})
export class UsersHttpModule {}
