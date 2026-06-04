import { Module } from '@nestjs/common';
import { ApiController } from './api.controller';
import { PipelineModule } from '../pipeline/pipeline.module';
import { BugsModule } from '../bugs/bugs.module';
import { GitModule } from '../git/git.module';
import { AppTesterModule } from '../common/app-tester.module';
import { AnalysisModule } from '../analysis/analysis.module';
import { HealthService } from '../health/health.service';

@Module({
  imports: [PipelineModule, BugsModule, GitModule, AppTesterModule, AnalysisModule],
  controllers: [ApiController],
  providers: [HealthService],
})
export class ApiModule {}
