import { Global, Module } from '@nestjs/common';
import { GithubTokenService } from './github-token.service';

@Global()
@Module({
  providers: [GithubTokenService],
  exports: [GithubTokenService],
})
export class GithubModule {}
