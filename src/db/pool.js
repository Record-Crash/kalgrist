import {  Pool  } from "pg";
import config from "../config.js";

const pool = new Pool({ connectionString: config.database.url });

pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
});

export { pool };
