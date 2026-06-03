import { Module } from '@nestjs/common';
import { AppTester } from './app-tester.service';

@Module({
  providers: [AppTester],
  exports: [AppTester],
})
export class AppTesterModule {}
