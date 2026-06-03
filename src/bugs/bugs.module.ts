import { Module } from '@nestjs/common';
import { BugRegistryService } from './bug-registry.service';

@Module({
  providers: [BugRegistryService],
  exports: [BugRegistryService],
})
export class BugsModule {}
