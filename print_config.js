import("prisma/config").then((p) => {
  console.log("env DATABASE_URL:", p.env("DATABASE_URL"));
});
