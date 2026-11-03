import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module.js';
import { MeController } from './me.controller.js';

/** HTTP endpoints for the current user; imported by the API process only. */
@Module({
  imports: [DocumentsModule],
  controllers: [MeController],
})
export class UsersHttpModule {}
