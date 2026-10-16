import { Global, Module } from '@nestjs/common';
import { GithubTokenService } from './github-token.service';
import { GithubUserService } from './github-user.service';

@Global()
@Module({
  providers: [GithubTokenService, GithubUserService],
  exports: [GithubTokenService, GithubUserService],
})
export class GithubModule {}
