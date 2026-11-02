import { Module } from '@nestjs/common';
import { ReviewController } from './review.controller.js';
import { ReviewModule } from './review.module.js';

/** HTTP endpoints for review; imported by the API process only. */
@Module({
  imports: [ReviewModule],
  controllers: [ReviewController],
})
export class ReviewHttpModule {}
