import * as SQLite from "expo-sqlite";

let database: SQLite.SQLiteDatabase | null = null;

export async function getDatabase() {
  if (!database) {
    database = await SQLite.openDatabaseAsync("motor_repair_phone.db");
    await database.execAsync("PRAGMA foreign_keys = ON;");
  }
  return database;
}

export async function run(sql: string, params: SQLite.SQLiteBindParams = []) {
  const db = await getDatabase();
  return db.runAsync(sql, params);
}

export async function all<T>(sql: string, params: SQLite.SQLiteBindParams = []) {
  const db = await getDatabase();
  return db.getAllAsync<T>(sql, params);
}

export async function first<T>(sql: string, params: SQLite.SQLiteBindParams = []) {
  const db = await getDatabase();
  return db.getFirstAsync<T>(sql, params);
}
