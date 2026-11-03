import type { CurrentUser as CurrentUserDto } from '@documind/shared';
import { Controller, Delete, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { DocumentsService } from '../documents/documents.service.js';
import type { User } from './users.repository.js';

@Controller('me')
export class MeController {
  constructor(private readonly documents: DocumentsService) {}

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

  /**
   * Erases the signed-in user's documents, files and profile. Irreversible.
   * The sign-in account stays with Supabase; the next request with a valid
   * token provisions a new, empty profile.
   */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async erase(@CurrentUser() user: User): Promise<void> {
    await this.documents.eraseOwner(user.id);
  }
}
