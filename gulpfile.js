var gulp = require('gulp');
var path = require('path');
var runSequence = require('run-sequence');
var del = require('del');
var jeditor = require("gulp-json-editor");

gulp.task('clean', function(callback) {
    runSequence('cover:clean', 'out:clean', callback);
});

gulp.task('cover:clean', function (done) {
    return del('coverage', done);
});

gulp.task('cover:enable',() => {
    return gulp.src("./coverconfig.json")
        .pipe(jeditor(function(json) {
            json.enabled = true;
            return json; // must return JSON object.
        }))
        .pipe(gulp.dest("./", {'overwrite':true}));
});

gulp.task('cover:disable', () => {
    return gulp.src("./coverconfig.json")
        .pipe(jeditor(function(json) {
            json.enabled = false;
            return json; // must return JSON object.
        }))
        .pipe(gulp.dest("./", {'overwrite':true}));
});

gulp.task('out:clean', function(callback) {
    return del('out', callback);
});
