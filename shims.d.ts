// mammoth's prebuilt browser bundle ships no declarations; its API is the
// same as the main entry. The shim also stops tsc from type-inferring the
// ~1 MB bundled JS under allowJs.
declare module 'mammoth/mammoth.browser.js' {
  const mammoth: typeof import('mammoth');
  export default mammoth;
}
