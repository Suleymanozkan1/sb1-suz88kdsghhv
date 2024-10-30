<?php
/**
 * Theme Customizer
 */

function meimei_customize_register($wp_customize) {
    // Social Media Section
    $wp_customize->add_section('meimei_social', array(
        'title' => __('Social Media Links', 'meimei'),
        'priority' => 30,
    ));

    // Twitter URL
    $wp_customize->add_setting('social_twitter', array(
        'default' => '',
        'sanitize_callback' => 'esc_url_raw',
    ));

    $wp_customize->add_control('social_twitter', array(
        'label' => __('Twitter URL', 'meimei'),
        'section' => 'meimei_social',
        'type' => 'url',
    ));

    // Telegram URL
    $wp_customize->add_setting('social_telegram', array(
        'default' => '',
        'sanitize_callback' => 'esc_url_raw',
    ));

    $wp_customize->add_control('social_telegram', array(
        'label' => __('Telegram URL', 'meimei'),
        'section' => 'meimei_social',
        'type' => 'url',
    ));

    // Colors Section
    $wp_customize->add_setting('primary_color', array(
        'default' => '#047857',
        'sanitize_callback' => 'sanitize_hex_color',
    ));

    $wp_customize->add_control(new WP_Customize_Color_Control($wp_customize, 'primary_color', array(
        'label' => __('Primary Color', 'meimei'),
        'section' => 'colors',
    )));
}
add_action('customize_register', 'meimei_customize_register');