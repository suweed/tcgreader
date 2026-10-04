const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://suweedtcg:postgres@localhost:5432/tcgreader',
  ssl: false
});
pool.query('SELECT 1 as result')
  .then(res => console.log("SUCCESS:", res.rows))
  .catch(err => console.error("DB ERROR:", err))
  .finally(() => pool.end());
