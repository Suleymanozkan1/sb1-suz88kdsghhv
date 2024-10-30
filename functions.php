<?php
/**
 * Mei Mei Theme Functions
 */

if (!defined('ABSPATH')) exit;

// Include Carbon Fields
require_once(__DIR__ . '/vendor/autoload.php');

use Carbon_Fields\Container;
use Carbon_Fields\Field;

// Theme Setup
function meimei_theme_setup() {
    add_theme_support('title-tag');
    add_theme_support('post-thumbnails');
    add_theme_support('custom-logo');
    add_theme_support('menus');
    
    register_nav_menus(array(
        'primary' => __('Primary Menu', 'meimei'),
        'footer' => __('Footer Menu', 'meimei'),
    ));
}
add_action('after_setup_theme', 'meimei_theme_setup');

// Enqueue Scripts and Styles
function meimei_enqueue_scripts() {
    wp_enqueue_style('meimei-style', get_stylesheet_uri(), array(), wp_get_theme()->get('Version'));
    wp_enqueue_script('meimei-scripts', get_template_directory_uri() . '/assets/js/main.js', array(), wp_get_theme()->get('Version'), true);
    
    wp_localize_script('meimei-scripts', 'meimeiData', array(
        'ajaxUrl' => admin_url('admin-ajax.php'),
        'nonce' => wp_create_nonce('meimei-nonce')
    ));
}
add_action('wp_enqueue_scripts', 'meimei_enqueue_scripts');

// Include Customizer Settings
require get_template_directory() . '/inc/customizer.php';

// Register Carbon Fields
function meimei_register_carbon_fields() {
    Container::make('theme_options', __('Theme Options'))
        ->add_tab(__('Hero Section'), array(
            Field::make('text', 'hero_title', __('Hero Title'))
                ->set_default_value('Welcome to Mei Mei\'s World'),
            Field::make('text', 'hero_subtitle', __('Hero Subtitle'))
                ->set_default_value('Where Nature Meets the Digital Frontier'),
            Field::make('image', 'hero_image', __('Hero Background'))
        ))
        ->add_tab(__('About Section'), array(
            Field::make('text', 'about_title', __('About Title'))
                ->set_default_value('Meet Mei Mei'),
            Field::make('rich_text', 'about_content', __('About Content')),
            Field::make('image', 'about_image', __('About Image')),
            Field::make('complex', 'about_features', __('Features'))
                ->add_fields(array(
                    Field::make('text', 'title', __('Title')),
                    Field::make('text', 'content', __('Content')),
                    Field::make('select', 'icon', __('Icon'))
                        ->add_options(array(
                            'heart' => 'Heart',
                            'sprout' => 'Sprout',
                            'tree-pine' => 'Tree'
                        ))
                ))
        ))
        ->add_tab(__('Tokenomics'), array(
            Field::make('text', 'tokenomics_title', __('Tokenomics Title'))
                ->set_default_value('Digital Ecosystem'),
            Field::make('complex', 'tokenomics_stats', __('Tokenomics Stats'))
                ->add_fields(array(
                    Field::make('text', 'title', __('Title')),
                    Field::make('text', 'value', __('Value')),
                    Field::make('text', 'description', __('Description')),
                    Field::make('select', 'icon', __('Icon'))
                        ->add_options(array(
                            'coins' => 'Coins',
                            'lock' => 'Lock',
                            'leaf' => 'Leaf'
                        ))
                ))
        ))
        ->add_tab(__('Join Section'), array(
            Field::make('text', 'join_title', __('Join Title'))
                ->set_default_value('Join the Digital Forest'),
            Field::make('text', 'join_subtitle', __('Join Subtitle'))
                ->set_default_value('Connect with our growing network of eco-conscious pioneers'),
            Field::make('complex', 'social_platforms', __('Social Platforms'))
                ->add_fields(array(
                    Field::make('text', 'name', __('Platform Name')),
                    Field::make('text', 'followers', __('Followers Count')),
                    Field::make('text', 'link', __('Profile URL')),
                    Field::make('select', 'icon', __('Icon'))
                        ->add_options(array(
                            'twitter' => 'Twitter',
                            'telegram' => 'Telegram'
                        )),
                    Field::make('text', 'color_class', __('Background Color Class'))
                )),
            Field::make('text', 'newsletter_title', __('Newsletter Title'))
                ->set_default_value('Join Our Community'),
            Field::make('text', 'newsletter_subtitle', __('Newsletter Subtitle'))
                ->set_default_value('Subscribe to our newsletter for exclusive updates'),
            Field::make('text', 'newsletter_form_shortcode', __('Newsletter Form Shortcode'))
        ));
}
add_action('after_setup_theme', 'meimei_register_carbon_fields');

// Boot Carbon Fields
function meimei_boot_carbon_fields() {
    \Carbon_Fields\Carbon_Fields::boot();
}
add_action('after_setup_theme', 'meimei_boot_carbon_fields');