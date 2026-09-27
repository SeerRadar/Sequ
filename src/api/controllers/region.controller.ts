import { settings } from '../../config/config.js';
import { success } from '../helpers/reply.js';
import type { Context } from 'hono';

export const getRegion = (c: Context): Response => {
  const { id, label } = settings.regionProfile;

  return c.json(success({ region: id, label }));
};
