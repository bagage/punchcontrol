const gulp = require('gulp');
const print = require('gulp-print').default;
const gutil = require('gulp-util');
const rename = require('gulp-rename');
const svgmin = require('gulp-svgmin');
const svgstore = require('gulp-svgstore');
const cheerio = require('gulp-cheerio');
const del = require('del');
// const favicons = require("gulp-favicons");

// ====================================
// Super-tasks
// ====================================
gulp.task('prepare', ['svg']);
gulp.task('clean', ['clean:svg']);
gulp.task('watch', ['watch:svg']);

// ====================================
// Utility functions
// ====================================
function logchange(event) {
    gutil.log('... ' + event.path + ' was ' + event.type)
};

// ====================================
// SVGs
// /!\ When saving in Inkscape make sure
//     that it generates a viewBox attribute
//     => w/o viewBox it will not work!!!
// ====================================
const SVG_SRC_PATH = 'design/svg/**/*.svg';
const SVG_DEST_PATH = 'client/src/assets/gen';
gulp.task('svg', function () {
    gulp
        .src(SVG_SRC_PATH)
        .pipe(cheerio({
            run: function ($) {
                $('[fill]').removeAttr('fill');
                $('[style]').removeAttr('style');
            },
            parserOptions: { xmlMode: true }
        }))
        .pipe(rename(function (path) {
            if (path.dirname !== '.') {
                let name = path.dirname.split(path.sep);
                name.push(path.basename);
                path.basename = name.join('-');
            }
        }))
        .pipe(svgmin())
        .pipe(svgstore({inlineSvg: true }))
        .pipe(gulp.dest(SVG_DEST_PATH))
        .pipe(print());
});
gulp.task('watch:svg', ['svg'], function () {
    const w = gulp.watch(SVG_SRC_PATH, ['svg']);
    w.on('change', logchange);
    return w;
});
gulp.task('clean:svg', function () {
    return del([
        SVG_DEST_PATH
    ]);
});

// gulp.task("favicon", function () {
//     return gulp.src("design/svg/logo.svg").pipe(favicons({
//         appName: "Punchcontrol",
//         display: "standalone",
//         orientation: "portrait",
//         start_url: "/?homescreen=1",
//         version: 1.0,
//         logging: false,
//         online: false,
//         html: "index.html",
//         pipeHTML: true,
//         replace: true
//     }))
//     .on("error", gutil.log)
//     .pipe(gulp.dest("./_favicon"));
// });