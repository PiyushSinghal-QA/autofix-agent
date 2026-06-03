import { Module } from '@nestjs/common';
import { ValidationService } from './validation.service';
import { AppTesterModule } from '../common/app-tester.module';

@Module({
  imports: [AppTesterModule],
  providers: [ValidationService],
  exports: [ValidationService],
})
export class ValidationModule {}
