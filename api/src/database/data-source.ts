import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { loadConfig } from '../common/app-config';
import { typeormOptions } from './typeorm-options';

/** Used by the TypeORM CLI (npm run migration:generate / migration:run). */
export default new DataSource(typeormOptions(loadConfig()));
