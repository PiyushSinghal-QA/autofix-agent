import { Module } from '@nestjs/common';
import { DetectorService } from './detector.service';
import { GitModule } from '../git/git.module';
import { BugsModule } from '../bugs/bugs.module';
import { AppTesterModule } from '../common/app-tester.module';

@Module({
  imports: [GitModule, BugsModule, AppTesterModule],
  providers: [DetectorService],
  exports: [DetectorService],
})
export class DetectorModule {}
