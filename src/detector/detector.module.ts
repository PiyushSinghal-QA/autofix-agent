import { Module } from '@nestjs/common';
import { DetectorService } from './detector.service';
import { BugsModule } from '../bugs/bugs.module';
import { AnalysisModule } from '../analysis/analysis.module';

@Module({
  imports: [BugsModule, AnalysisModule],
  providers: [DetectorService],
  exports: [DetectorService],
})
export class DetectorModule {}
