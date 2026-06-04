import { Module } from '@nestjs/common';
import { AnalysisService } from './analysis.service';
import { BugsModule } from '../bugs/bugs.module';

@Module({
  imports: [BugsModule],
  providers: [AnalysisService],
  exports: [AnalysisService],
})
export class AnalysisModule {}
