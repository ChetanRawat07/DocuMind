import type { CurrentUser as CurrentUserDto } from '@documind/shared';
import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { User } from './users.repository.js';

@Controller('me')
export class MeController {
  /** The signed-in user. Also the web app's first call, which provisions the user on sign-up. */
  @Get()
  get(@CurrentUser() user: User): CurrentUserDto {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
