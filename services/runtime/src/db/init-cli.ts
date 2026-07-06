import { initializeRuntimeDatabase } from "./init.js";

const handle = initializeRuntimeDatabase();
handle.database.close();

console.log(
  JSON.stringify(
    {
      status: "ok",
      databasePath: handle.databasePath
    },
    null,
    2
  )
);
