import { Module } from '@nestjs/common';
import { ValidationService } from './validation.service';
import { AppTesterModule } from '../common/app-tester.module';
import { BugsModule } from '../bugs/bugs.module';

@Module({
  imports: [AppTesterModule, BugsModule],
  providers: [ValidationService],
  exports: [ValidationService],
})
export class ValidationModule {}
