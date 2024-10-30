<?php
/**
 * Theme Zip Generator
 * 
 * Run this file to generate a WordPress theme zip file
 * php build-theme.php
 */

$theme_name = 'meimei-eco';
$exclude_patterns = array(
    '.git',
    '.github',
    'node_modules',
    '.DS_Store',
    'build-theme.php',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'vite.config.ts',
    '.eslintrc',
    'README.md',
    'dist/assets/*.map',
    '*.log'
);

// Create zip archive
$zip = new ZipArchive();
$zip_name = "{$theme_name}.zip";

if ($zip->open($zip_name, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== TRUE) {
    die("Could not create zip archive\n");
}

// Helper function to check if path should be excluded
function should_exclude($path, $patterns) {
    foreach ($patterns as $pattern) {
        if (strpos($path, $pattern) !== false) {
            return true;
        }
    }
    return false;
}

// Add files recursively
function add_files_to_zip($zip, $path, $exclude_patterns) {
    $files = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($path),
        RecursiveIteratorIterator::LEAVES_ONLY
    );

    foreach ($files as $file) {
        if ($file->isDir()) {
            continue;
        }

        $filePath = $file->getRealPath();
        $relativePath = substr($filePath, strlen($path) + 1);

        if (!should_exclude($relativePath, $exclude_patterns)) {
            $zip->addFile($filePath, $relativePath);
        }
    }
}

// Add theme files
add_files_to_zip($zip, __DIR__, $exclude_patterns);

// Close zip archive
$zip->close();

echo "Theme zip file created successfully: {$zip_name}\n";