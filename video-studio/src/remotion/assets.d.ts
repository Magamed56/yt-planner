// Webpack-бандлер Remotion отдаёт шрифты и картинки как asset/resource —
// импорт возвращает URL файла внутри бандла. Объявления нужны только tsc.
declare module "*.woff2" {
  const src: string;
  export default src;
}
declare module "*.png" {
  const src: string;
  export default src;
}
