function port(value, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < 1 || number > 65535)
    throw new Error("Invalid Studio port");
  return number;
}
const api = port(process.env.STUDIO_API_PORT, 43201);
const ui = port(process.env.STUDIO_UI_PORT, 43202);
if (api === ui) throw new Error("Studio ports must differ");
module.exports = { api, ui };
