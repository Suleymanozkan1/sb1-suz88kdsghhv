<?php
/**
 * Header Template
 */
?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
    <meta charset="<?php bloginfo('charset'); ?>">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <?php wp_head(); ?>
</head>
<body <?php body_class('min-h-screen bg-emerald-50 text-emerald-900'); ?>>
<?php wp_body_open(); ?>

<header class="fixed w-full z-50">
    <nav class="container mx-auto px-6 py-4">
        <div class="flex items-center justify-between">
            <div class="flex items-center space-x-2">
                <?php 
                if (has_custom_logo()) {
                    the_custom_logo();
                } else {
                    echo '<span class="text-2xl font-bold text-white">' . get_bloginfo('name') . '</span>';
                }
                ?>
            </div>
            
            <?php
            wp_nav_menu(array(
                'theme_location' => 'primary',
                'container_class' => 'hidden md:flex items-center space-x-8',
                'menu_class' => '',
                'link_class' => 'text-white hover:text-emerald-200 transition-colors',
                'fallback_cb' => false
            ));
            ?>
            
            <button class="md:hidden text-white menu-toggle">
                <span class="sr-only">Toggle Menu</span>
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16m-16 6h16"/>
                </svg>
            </button>
        </div>

        <div class="mobile-menu hidden md:hidden mt-4 p-4 bamboo-card rounded-lg">
            <?php
            wp_nav_menu(array(
                'theme_location' => 'primary',
                'container' => false,
                'menu_class' => 'mobile-menu-items',
                'link_class' => 'block py-2 text-emerald-800 hover:text-emerald-600',
                'fallback_cb' => false
            ));
            ?>
        </div>
    </nav>
</header>