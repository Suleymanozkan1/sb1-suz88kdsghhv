<?php
/**
 * Main Template File
 */

get_header();
?>

<div class="min-h-screen relative">
    <?php get_template_part('template-parts/bamboo-background'); ?>
    
    <main>
        <?php 
        get_template_part('template-parts/hero');
        get_template_part('template-parts/about');
        get_template_part('template-parts/tokenomics');
        get_template_part('template-parts/join');
        ?>
    </main>
</div>

<?php
get_footer();